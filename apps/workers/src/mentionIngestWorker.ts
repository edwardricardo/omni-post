/**
 * @file mentionIngestWorker.ts
 * @description BullMQ worker that ingests brand mentions into the normalized
 *              listening corpus. Handles two job kinds:
 *                - "search": polls a search-capable provider (X, Bluesky) for
 *                  posts mentioning the project's tracked terms (market-wide).
 *                - "fetch": fetch-before-process for a webhook mention
 *                  notification (Meta/IG own-brand mention).
 *              Mentions are normalized to the canonical Mention model and
 *              deduplicated by the (provider, externalId) unique constraint, so
 *              reprocessing the same job is idempotent.
 *
 *              Exports `startMentionIngestWorker()` for composition under
 *              `bootstrap.ts`; also runs standalone when invoked directly.
 * @layer infrastructure
 */

import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { createLogger } from "@observability/logger";
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
import type { Provider, PrismaClient } from "@infra/prisma";
import { setTenantGuc } from "@infra/prisma/extensions/tenantGuc.js";
import { verifyDatabaseAuth } from "./container/workerContainer.js";
import { env } from "./config/env.js";
import { createPrismaRepoAdapter, PrismaMentionRepository } from "@adapters/db-prisma";
import { decryptChannelCredentials } from "@shared/types";
import type { ProviderAdapter, ProviderMention } from "@ports/core";
import { IngestMentionUseCase } from "@core/listening/IngestMentionUseCase.js";
import type { ProviderType } from "@core/domain/value-objects/Provider.js";

const logger = createLogger("mention-ingest-worker");

// Cap pages per search job: each page is one paid provider read (X bills per
// read), so bound the fan-out per cycle. Reconciliation widens the window, not
// the page count.
const MAX_SEARCH_PAGES = 5;
const SEARCH_PAGE_SIZE = 100;

// Built lazily on first use (and eagerly at worker startup) rather than at
// module import, so importing this module to unit-test its pure helpers does
// not require PLATFORM_ENCRYPTION_KEY. The fail-fast on a missing key still
// fires at worker startup via startMentionIngestWorker's getCredentialResolver
// call, not at module import time.
let cachedCredentialResolver: CredentialResolver | undefined;
function getCredentialResolver(prisma: PrismaClient): CredentialResolver {
  if (cachedCredentialResolver) {
    return cachedCredentialResolver;
  }
  // env.PLATFORM_ENCRYPTION_KEY is validated fail-fast at module load by the
  // workers env module (env.ts). No runtime guard needed here.
  const platformEncryptionKey = env.PLATFORM_ENCRYPTION_KEY;
  const repo = createPrismaRepoAdapter({
    prisma,
    decryptChannelCredentials: (envelope: {
      credentialsCiphertext: string;
      credentialsIv: string;
      credentialsAuthTag: string;
      credentialsKeyVersion: number;
    }) => decryptChannelCredentials(envelope, platformEncryptionKey),
  });
  cachedCredentialResolver = new CredentialResolver(repo);
  return cachedCredentialResolver;
}

/** Per-job injected dependencies (from the workers composition root). */
interface MentionJobDeps {
  prisma: PrismaClient;
  authFailureRecorder: ChannelAuthFailureRecorder;
  ingestMention: IngestMentionUseCase;
}

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

interface TrackedTermPayload {
  id: string;
  term: string;
  kind: string;
}

interface SearchJob {
  kind: "search";
  channelId: string;
  accountId: string;
  projectId: string;
  provider: string;
  terms: TrackedTermPayload[];
  since?: string;
}

interface FetchJob {
  kind: "fetch";
  channelId: string;
  accountId: string;
  projectId: string;
  provider: string;
  providerMentionId: string;
}

type MentionJob = SearchJob | FetchJob;

/**
 * Look up the channel referenced by a job and return its provider enum + adapter.
 * Returns undefined when the channel is gone or the provider has no adapter.
 */
async function resolveChannelAdapter(
  channelId: string,
  accountId: string,
  deps: MentionJobDeps
): Promise<{ providerEnum: Provider; providerName: string; adapter: ProviderAdapter } | undefined> {
  // Bind the RLS GUC and scope the lookup by the job's tenant in one
  // transaction so a foreign channelId resolves nothing (D3/D9). The explicit
  // `accountId` predicate is the active isolation; the GUC future-proofs the
  // path for a hardened NOBYPASSRLS role.
  const channel = await deps.prisma.$transaction(async (tx) => {
    await setTenantGuc(tx, accountId);
    return tx.channel.findFirst({
      where: { id: channelId, accountId, deletedAt: null },
      select: { id: true, provider: true },
    });
  });
  if (!channel) {
    logger.warn({ channelId }, "Channel not found, skipping");
    return undefined;
  }
  const providerName = channel.provider.toLowerCase();
  const adapter = providerAdapters[providerName];
  if (!adapter) {
    logger.debug({ channelId, provider: providerName }, "No adapter for provider");
    return undefined;
  }
  return { providerEnum: channel.provider, providerName, adapter };
}

/**
 * Persist one normalized mention. Idempotent via the (provider, externalId)
 * unique constraint: an existing row or a concurrent insert (P2002) counts as a
 * skip, never a duplicate.
 */
async function persistMention(
  mention: ProviderMention,
  context: {
    accountId: string;
    projectId: string;
    providerEnum: Provider;
    source: "SEARCH" | "WEBHOOK";
    channelId?: string;
    trackedTermId?: string;
  },
  deps: MentionJobDeps
): Promise<"created" | "skipped"> {
  const result = await deps.ingestMention.execute({
    accountId: context.accountId,
    projectId: context.projectId,
    ...(context.channelId !== undefined && { channelId: context.channelId }),
    provider: context.providerEnum as ProviderType,
    externalId: mention.providerMentionId,
    source: context.source,
    ...(context.trackedTermId !== undefined && { trackedTermId: context.trackedTermId }),
    authorName: mention.authorName,
    ...(mention.authorHandle !== undefined && { authorHandle: mention.authorHandle }),
    ...(mention.authorAvatarUrl !== undefined && { authorAvatarUrl: mention.authorAvatarUrl }),
    authorProviderId: mention.authorProviderId,
    ...(mention.url !== undefined && { url: mention.url }),
    body: mention.body,
    ...(mention.lang !== undefined && { lang: mention.lang }),
    ...(mention.mediaUrls !== undefined &&
      mention.mediaUrls.length > 0 && { mediaUrls: mention.mediaUrls }),
    providerCreatedAt: mention.createdAt,
  });

  // Transient failures (INTERNAL_ERROR) propagate so BullMQ retries; the
  // (provider, externalId) unique constraint keeps retries idempotent.
  if (!result.ok) {
    throw result.error;
  }
  return result.value.isNew ? "created" : "skipped";
}

/**
 * @function matchTrackedTermId
 * @description Attribute a mention to the first tracked term whose text appears
 *              in its body (case-insensitive substring match).
 * @param body - Mention body text.
 * @param terms - Tracked terms to test against.
 * @returns The matching term id, or undefined when no term matches.
 */
export function matchTrackedTermId(body: string, terms: TrackedTermPayload[]): string | undefined {
  const lowerBody = body.toLowerCase();
  const matched = terms.find((t) => lowerBody.includes(t.term.toLowerCase()));
  return matched?.id;
}

async function processSearchJob(job: SearchJob, deps: MentionJobDeps): Promise<void> {
  const { channelId, accountId, projectId, terms } = job;
  if (terms.length === 0) {
    return;
  }

  const resolved = await resolveChannelAdapter(channelId, accountId, deps);
  if (!resolved) {
    return;
  }
  const { providerEnum, providerName, adapter } = resolved;
  const searchMentions = adapter.searchMentions?.bind(adapter);
  if (!searchMentions) {
    return;
  }

  const credentialResult = await getCredentialResolver(deps.prisma).resolve(channelId, accountId);
  if (!credentialResult.ok) {
    await handleProviderAuthError(
      deps.authFailureRecorder,
      channelId,
      providerName,
      "Credential lookup failed during mention search",
      accountId
    );
    throw new Error(`Provider ${providerName} returned error: AUTH`);
  }

  const since = job.since ? new Date(job.since) : undefined;
  const termStrings = terms.map((t) => t.term);

  let cursor: string | undefined;
  let pages = 0;
  let synced = 0;
  let skipped = 0;

  do {
    const result = await searchMentions({
      channelCredentials: credentialResult.value,
      terms: termStrings,
      ...(since !== undefined && { since }),
      ...(cursor !== undefined && { cursor }),
      limit: SEARCH_PAGE_SIZE,
    });

    if (!result.ok) {
      if (result.error === "AUTH") {
        await handleProviderAuthError(
          deps.authFailureRecorder,
          channelId,
          providerName,
          "Provider rejected credentials during mention search",
          accountId
        );
      }
      throw new Error(`Provider ${providerName} returned error: ${result.error}`);
    }

    for (const mention of result.value.mentions) {
      const trackedTermId = matchTrackedTermId(mention.body, terms);
      const outcome = await persistMention(
        mention,
        {
          accountId,
          projectId,
          providerEnum,
          source: "SEARCH",
          ...(trackedTermId !== undefined && { trackedTermId }),
        },
        deps
      );
      if (outcome === "created") synced++;
      else skipped++;
    }

    cursor = result.value.nextCursor;
    pages++;
  } while (cursor && pages < MAX_SEARCH_PAGES);

  logger.info(
    { channelId, provider: providerName, synced, skipped, pages },
    "Mention search completed"
  );
}

async function processFetchJob(job: FetchJob, deps: MentionJobDeps): Promise<void> {
  const { channelId, accountId, projectId, providerMentionId } = job;

  const resolved = await resolveChannelAdapter(channelId, accountId, deps);
  if (!resolved) {
    return;
  }
  const { providerEnum, providerName, adapter } = resolved;
  const fetchMentionById = adapter.fetchMentionById?.bind(adapter);
  if (!fetchMentionById) {
    return;
  }

  const credentialResult = await getCredentialResolver(deps.prisma).resolve(channelId, accountId);
  if (!credentialResult.ok) {
    await handleProviderAuthError(
      deps.authFailureRecorder,
      channelId,
      providerName,
      "Credential lookup failed during mention fetch",
      accountId
    );
    throw new Error(`Provider ${providerName} returned error: AUTH`);
  }

  const result = await fetchMentionById({
    channelCredentials: credentialResult.value,
    providerMentionId,
  });

  if (!result.ok) {
    if (result.error === "NOT_FOUND") {
      logger.warn({ channelId, provider: providerName, providerMentionId }, "Mention not found");
      return;
    }
    if (result.error === "AUTH") {
      await handleProviderAuthError(
        deps.authFailureRecorder,
        channelId,
        providerName,
        "Provider rejected credentials during mention fetch",
        accountId
      );
    }
    throw new Error(`Provider ${providerName} returned error: ${result.error}`);
  }

  const outcome = await persistMention(
    result.value,
    {
      accountId,
      projectId,
      providerEnum,
      source: "WEBHOOK",
      channelId,
    },
    deps
  );

  logger.info({ channelId, provider: providerName, outcome }, "Mention fetch completed");
}

async function processJob(jobData: MentionJob, deps: MentionJobDeps): Promise<void> {
  if (jobData.kind === "search") {
    await processSearchJob(jobData, deps);
    return;
  }
  await processFetchJob(jobData, deps);
}

export interface StartMentionIngestWorkerOptions {
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
 * @function startMentionIngestWorker
 * @description Boots the mention-ingest BullMQ worker + its Redis connection.
 * @returns ShutdownTarget so a composer (`bootstrap.ts`) can drain it.
 */
export async function startMentionIngestWorker(
  options: StartMentionIngestWorkerOptions
): Promise<ShutdownTarget> {
  await verifyDatabaseAuth();

  // Fail fast at startup if PLATFORM_ENCRYPTION_KEY is missing (and warm the
  // resolver), instead of deferring the failure to the first processed job.
  // Thread options.prisma through so the resolver uses the injected client.
  getCredentialResolver(options.prisma);

  const authFailureRecorder = new ChannelAuthFailureRecorder({ prisma: options.prisma });
  const ingestMention = new IngestMentionUseCase(new PrismaMentionRepository(options.prisma));
  const deps: MentionJobDeps = { prisma: options.prisma, authFailureRecorder, ingestMention };

  // Uses env.REDIS_URL — no fallback (SECURITY_CANON §Secrets, CWE-798).
  const connection = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    // No commandTimeout: BullMQ Worker uses blocking commands (BZPOPMIN,
    // XREAD BLOCK) that legitimately wait indefinitely for jobs. Liveness is
    // enforced via lockDuration + stalledInterval and TCP keepAlive.
    connectTimeout: 10_000,
    keepAlive: 30_000,
  });

  const worker = new Worker(
    QUEUE_NAMES.MENTION_INGEST,
    async (job) => {
      await processJob(job.data as MentionJob, deps);
    },
    {
      connection,
      concurrency: 5,
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 100 },
      // Global token bucket: caps provider reads across all jobs (X bills per
      // read). 20 jobs / 60 s is a conservative ceiling; tune per tenant later.
      limiter: { max: 20, duration: 60_000 },
      // Provider search/fetch can stall; 60 s lock with stalled detection on the
      // second tick (30 s) mirrors the inbox/analytics workers.
      lockDuration: 60_000,
      stalledInterval: 30_000,
      drainDelay: 5,
    }
  );

  worker.on("completed", (job) => {
    logger.debug({ jobId: job.id }, "Mention ingest job completed");
  });

  worker.on("failed", (job, error) => {
    logger.error({ jobId: job?.id, error: error.message }, "Mention ingest job failed");
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
    registerGracefulShutdown({ name: "mention-ingest", target, logger });
  }

  logger.info("Mention ingest worker started, listening on queue: %s", QUEUE_NAMES.MENTION_INGEST);
  return target;
}

// Standalone entry point: when invoked directly (e.g., `node dist/mentionIngestWorker.js`)
// rather than imported by `bootstrap.ts`, kick off the worker.
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  void startMentionIngestWorker({
    prisma: (await import("./container/workerContainer.js")).workerPrisma,
  });
}
