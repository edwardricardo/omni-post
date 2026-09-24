/**
 * @file publishWorkerRecord.ts
 * @description The write the publish worker performs once a provider has accepted a
 *   channel's content, as the integration suites drive it.
 *
 *   These suites stand in for ONE thing: the call that leaves the process and reaches
 *   a social platform. Everything the worker does with what that call returned is the
 *   production path, and this is the first half of it — `RecordChannelPublicationAttemptUseCase`
 *   over the real aggregate, in the tenant scope the job carries. It has to be the real
 *   write, because the saga's wait step settles on the publication record: a double
 *   answering for that record would report a green saga over a writer that never ran.
 *
 *   Requires Postgres up (`pnpm db:up`).
 *
 * @layer infrastructure
 */

import assert from "node:assert/strict";
import { ContentFingerprint, FragmentReference, providedReference } from "@core/domain/index.js";
import type { RecordChannelPublicationAttemptUseCase } from "@core/posts";
import { withTenantContext } from "../../../src/security/tenantContext.js";

/** Which (post, channel, episode) the worker is reporting on, and under whose tenant. */
export interface PublishedAttempt {
  accountId: string;
  postId: string;
  channelId: string;
  episode: number;
  /** BullMQ's ordinal plus one; the record refuses one it has already applied. */
  attemptNo?: number;
  /** The identifier the provider returned for the single fragment that went out. */
  externalId?: string;
}

/**
 * @function recordPublishedAttempt
 * @description Records that every fragment of a single-item post went out on one
 *   channel, exactly as `publishOutcomeRecorder` does for the real worker.
 * @param useCase - The real attempt writer, wired over the suite's repository.
 * @param attempt - The target, the episode, and the provider's identifier.
 * @returns Nothing; a refusal fails the calling suite rather than being swallowed,
 *   because a silent one would leave the channel unresolved and the saga waiting.
 */
export async function recordPublishedAttempt(
  useCase: RecordChannelPublicationAttemptUseCase,
  attempt: PublishedAttempt
): Promise<void> {
  const externalId = attempt.externalId ?? `provider-${attempt.channelId}-e${attempt.episode}`;
  const fragment = FragmentReference.create({ index: 1, externalId });
  const head = providedReference(externalId);
  assert.ok(fragment.ok && head.ok, "the fragment reference fixture must be constructible");

  const recorded = await withTenantContext({ accountId: attempt.accountId }, () =>
    useCase.execute({
      postId: attempt.postId,
      channelId: attempt.channelId,
      episode: attempt.episode,
      attemptNo: attempt.attemptNo ?? 1,
      planSize: 1,
      result: {
        kind: "published",
        fragments: [fragment.value],
        head: head.value,
        publishedAt: new Date(),
        contentHash: ContentFingerprint.ofContent({ body: attempt.postId, mediaIds: [] }),
      },
    })
  );

  assert.ok(
    recorded.ok,
    `the worker's publication write was refused: ${recorded.ok ? "" : recorded.error.message}`
  );
}
