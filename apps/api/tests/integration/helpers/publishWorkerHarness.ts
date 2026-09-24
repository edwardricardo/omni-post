/**
 * @file publishWorkerHarness.ts
 * @description The record-side collaborators a REAL `PublishHandler` needs when an
 *   integration suite drives it against a real database.
 *
 *   The publish worker settles nothing on its own any more: before it calls a provider it
 *   reads the publication record to learn whether the channel it is addressed at is still
 *   open at the episode its job id names, and after the provider answers it writes the
 *   outcome back to that same record. A suite that plants a post and a channel through
 *   Prisma alone has therefore planted a job the worker must refuse, because no episode
 *   was ever opened for it.
 *
 *   So this builds the real path — the real repository, the real episode use case, the
 *   real attempt writer, the real probe and the real outcome recorder — over the worker's
 *   own tenant provider, which is the one both the probe and the recorder bind. Doubling
 *   any of it would report a green worker over a record nothing wrote.
 *
 *   Requires Postgres up (`pnpm db:up`).
 *
 * @layer infrastructure
 */

import assert from "node:assert/strict";
import { type PrismaClient } from "@infra/prisma";
import { tenantGuardExtension } from "@infra/prisma/extensions/tenantGuard.js";
import { PrismaPostRepository, PrismaUnitOfWork } from "@adapters/db-prisma";
import {
  OpenPublicationEpisodeUseCase,
  RecordChannelPublicationAttemptUseCase,
} from "@core/posts/index.js";
import { ChannelId, PostId, type ChannelPublication } from "@core/domain/index.js";
import {
  withWorkerTenant,
  workerTenantProvider,
} from "../../../../../apps/workers/src/security/workerTenantContext.js";
import {
  createPublicationRecordProbe,
  type PublicationRecordProbe,
} from "../../../../../apps/workers/src/publicationRecordProbe.js";
import {
  createPublishOutcomeRecorder,
  type PublishOutcomeRecorder,
} from "../../../../../apps/workers/src/publishOutcomeRecorder.js";

/** Which (post, channels) an episode is opened over, and under whose tenant. */
export interface OpenEpisodeRequest {
  accountId: string;
  postId: string;
  channelIds: readonly string[];
}

/** Where a channel's record stands, for a suite that asserts on it directly. */
export interface ChannelRecordRequest {
  accountId: string;
  postId: string;
  channelId: string;
}

/** The record-side collaborators, plus the two reads a suite drives them with. */
export interface PublishWorkerHarness {
  /** Read by the handler before any provider call; the real probe over the real repo. */
  readonly publicationRecord: PublicationRecordProbe;
  /** The real recorder over the real attempt writer; the mirror row follows its commit. */
  readonly outcomeRecorder: PublishOutcomeRecorder;
  /**
   * Opens an episode for exactly one channel and answers its ordinal, which is what the
   * job id must then carry. One channel, because a suite that opened several and took the
   * first ordinal would be relying on an order the use case never promised.
   */
  openEpisode(request: OpenEpisodeRequest): Promise<number>;
  /** The channel's recorded state, or undefined when the post holds no entry for it. */
  readChannelRecord(request: ChannelRecordRequest): Promise<ChannelPublication | undefined>;
}

/**
 * The durable half of the outcome write: in production an inline write that loses its
 * compare-and-swap is handed to a queue, and these suites do not run that consumer.
 *
 * It answers `ok` rather than failing, so the recorder takes the same branch it takes in
 * production. Nothing inspects what lands here, and a suite that wants to know the write
 * happened must ASSERT ON THE RECORD — `readChannelRecord` — because the mirror row does
 * not imply it. `PublishHandler.recordOutcome` returns false rather than throwing when the
 * outcome write fails, and `writeReceiptMirror` runs unconditionally after it, so a suite
 * that checks only `publish_log` goes green with the record writer entirely dead. That was
 * measured on the tenant-isolation suite, which had exactly that gap when this helper was
 * written; an earlier draft of this paragraph claimed the mirror "only follows a committed
 * record", and it does not.
 */
function acceptingQueue(): {
  enqueue(job: { dedupeKey: string }): Promise<{ ok: true; value: string }>;
} {
  return {
    async enqueue(job) {
      return { ok: true, value: job.dedupeKey };
    },
  };
}

/**
 * @function createPublishWorkerHarness
 * @description Wires the publication-record path over a raw test client, mirroring the
 *   workers composition root: one guarded client, one tenant provider, one unit of work.
 * @param base - The suite's raw Prisma client; the guard is applied here, not by the caller.
 * @returns The harness.
 */
export function createPublishWorkerHarness(base: PrismaClient): PublishWorkerHarness {
  const guarded = base.$extends(
    tenantGuardExtension(workerTenantProvider)
  ) as unknown as PrismaClient;
  const postRepository = new PrismaPostRepository(guarded, undefined, workerTenantProvider);
  const unitOfWork = new PrismaUnitOfWork(guarded, workerTenantProvider);
  const openPublicationEpisode = new OpenPublicationEpisodeUseCase(postRepository, unitOfWork);
  const recordAttempt = new RecordChannelPublicationAttemptUseCase(postRepository, unitOfWork);

  return {
    publicationRecord: createPublicationRecordProbe(postRepository),
    outcomeRecorder: createPublishOutcomeRecorder({
      recordAttempt,
      outcomeQueue: acceptingQueue(),
      deadLetterQueue: acceptingQueue(),
      unrecorded: { inc: () => undefined },
      logger: { warn: () => undefined, error: () => undefined },
    }),

    async openEpisode(request) {
      assert.strictEqual(
        request.channelIds.length,
        1,
        "open one channel per call: the ordinal answered must be the one the caller asked about"
      );
      const opened = await withWorkerTenant(request.accountId, () =>
        openPublicationEpisode.execute({
          postId: request.postId,
          channelIds: request.channelIds,
          enterPublishing: true,
        })
      );
      assert.ok(
        opened.ok,
        `the publication episode was refused: ${opened.ok ? "" : opened.error.message}`
      );
      const channel = opened.value.opened[0];
      assert.ok(channel, "the episode opened no channel, so there is no ordinal to publish at");
      return channel.episode;
    },

    async readChannelRecord(request) {
      const postId = PostId.fromString(request.postId);
      const channelId = ChannelId.fromString(request.channelId);
      assert.ok(postId.ok && channelId.ok, "the record read needs well-formed identifiers");
      const post = await withWorkerTenant(request.accountId, () =>
        postRepository.findById(postId.value)
      );
      assert.ok(post.ok, `the post could not be loaded: ${post.ok ? "" : post.error.message}`);
      return post.value.publications.find(channelId.value);
    },
  };
}
