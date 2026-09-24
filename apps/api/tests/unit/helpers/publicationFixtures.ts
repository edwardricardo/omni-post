/**
 * @file publicationFixtures.ts
 * @description Fixtures for driving a Post through the publication family now that
 *   the word has ONE source: the per-channel publication record. A post that declared
 *   no target cannot enter the family, cannot be published and cannot be failed, so
 *   every suite that used to call `startPublishing(providers)` and
 *   `markAsPublished(results)` has to declare targets and settle attempts instead.
 *   The helpers live here rather than in each suite because five of them need the
 *   same three steps, and a fixture copied five times drifts five ways.
 * @layer infrastructure
 */

import { expect } from "vitest";
import {
  ChannelId,
  ContentFingerprint,
  FragmentReference,
  providedReference,
  CHANNEL_FAILURE_CODES,
  ATTEMPT_CLASSIFICATIONS,
  PUBLICATION_OUTCOME_KINDS,
  type AttemptResult,
  type PostAggregate,
} from "@core/domain/index.js";

/** The two channels every publication fixture in these suites publishes to. */
export const FIXTURE_CHANNEL_A = ChannelId.generate();
export const FIXTURE_CHANNEL_B = ChannelId.generate();

/**
 * @function withPublicationTargets
 * @description Declares the post's intended channels and opens its first attempt
 *   episode, which is the state every publishing hop now starts from.
 * @param post - The post to give a record set
 * @param channels - The intended channels; the first fixture channel by default
 * @returns The same post, so a fixture reads as one expression
 */
export function withPublicationTargets(
  post: PostAggregate,
  channels: readonly ChannelId[] = [FIXTURE_CHANNEL_A]
): PostAggregate {
  const declared = post.declarePublicationTargets(channels);
  expect(declared.ok).toBe(true);
  const opened = post.openPublicationEpisode({ enterPublishing: false });
  expect(opened.ok).toBe(true);
  return post;
}

/**
 * @function publishedAttempt
 * @description An attempt that put every fragment of a one-fragment plan out.
 * @param externalId - The provider reference the channel came back with
 * @returns The attempt result the record settles as PUBLISHED
 */
export function publishedAttempt(externalId = "x-1"): AttemptResult {
  const head = providedReference(externalId);
  expect(head.ok).toBe(true);
  if (!head.ok) {
    throw new Error("the fixture head must build");
  }
  const fragment = FragmentReference.create({ index: 1, externalId });
  expect(fragment.ok).toBe(true);
  if (!fragment.ok) {
    throw new Error("the fixture fragment must build");
  }
  return {
    kind: PUBLICATION_OUTCOME_KINDS.PUBLISHED,
    head: head.value,
    fragments: [fragment.value],
    publishedAt: new Date("2026-03-01T09:00:00.000Z"),
    contentHash: ContentFingerprint.ofContent({ body: "fixture", mediaIds: [] }),
  };
}

/**
 * @function failedAttempt
 * @description An attempt that put NOTHING out and cannot be retried, which is what
 *   settles a channel as excluded rather than leaving it unresolved.
 * @returns The attempt result the record settles as EXCLUDED
 */
export function failedAttempt(): AttemptResult {
  return {
    kind: "failed",
    classification: ATTEMPT_CLASSIFICATIONS.NONTRANSIENT,
    code: CHANNEL_FAILURE_CODES.CHANNEL_AUTH_REQUIRED,
    publishedFragments: [],
  };
}

/**
 * @function settleChannel
 * @description Records one channel's attempt, which is the only thing that moves the
 *   post's word: entering the family, the channel event and the derived status all
 *   happen inside this one call.
 * @param post - The post whose channel settled
 * @param channelId - The channel the attempt ran for
 * @param result - What the attempt achieved
 */
export function settleChannel(
  post: PostAggregate,
  channelId: ChannelId,
  result: AttemptResult
): void {
  const applied = post.recordChannelAttempt({
    channelId,
    episode: 1,
    attemptNo: 1,
    planSize: 1,
    result,
  });
  expect(applied.ok).toBe(true);
}

/**
 * @function publishOnOneChannel
 * @description Declares one target and publishes it, which is the shortest honest
 *   route to a PUBLISHED post.
 * @param post - The post to publish
 * @param externalId - The provider reference the channel came back with
 * @returns The same post, now PUBLISHED
 */
export function publishOnOneChannel(post: PostAggregate, externalId = "x-1"): PostAggregate {
  withPublicationTargets(post);
  settleChannel(post, FIXTURE_CHANNEL_A, publishedAttempt(externalId));
  return post;
}

/**
 * @function failOnOneChannel
 * @description Declares one target and excludes it with nothing live, which is the
 *   shortest honest route to a FAILED post that is still editable.
 * @param post - The post to fail
 * @returns The same post, now FAILED
 */
export function failOnOneChannel(post: PostAggregate): PostAggregate {
  withPublicationTargets(post);
  settleChannel(post, FIXTURE_CHANNEL_A, failedAttempt());
  return post;
}
